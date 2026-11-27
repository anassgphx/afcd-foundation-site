// A small Excel (.xlsx) writer with no dependency: an .xlsx file is a zip of XML parts. Supports several sheets, a title
// block, a frozen and filterable header row, column widths, dates and numbers as real cell types, and a fixed set of
// styles (status colours among them). Every value is written as text or number, never as a formula, so a value that
// starts with "=" cannot run in Excel.
import { deflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------- zip (deflate + CRC-32, as the format requires)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: { name: string; data: string }[]) {
  const parts: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  const now = new Date(); const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1); const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const raw = Buffer.from(f.data, 'utf8'), comp = deflateRawSync(raw), name = Buffer.from(f.name, 'utf8'), crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, name, comp); central.push(cen, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------------------------------------------------------------- styles (index = the `s` attribute of a cell)
export const S = { text: 1, header: 2, title: 3, note: 4, date: 5, num1: 6, ref: 7, wrap: 8, bold: 9,
  grey: 10, blue: 11, violet: 12, amber: 13, green: 14, red: 15, slate: 16 } as const;
export type Tone = 'grey' | 'blue' | 'violet' | 'amber' | 'green' | 'red' | 'slate';
const TONES: Record<Tone, [string, string]> = { grey: ['F3F3F1', '3F3F46'], blue: ['EAF2FF', '1D4ED8'], violet: ['F1EDFF', '5B21B6'], amber: ['FEF6E4', '92400E'], green: ['EAF7EE', '166534'], red: ['FDEEEE', 'B42318'], slate: ['F1F3F5', '475569'] };
const tones = Object.values(TONES);
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="d mmm yyyy, hh:mm"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>
<fonts count="${6 + tones.length}"><font><sz val="11"/><color rgb="FF18181B"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="18"/><color rgb="FF18181B"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF5F5B57"/><name val="Calibri"/><family val="2"/></font><font><sz val="11"/><color rgb="FF18181B"/><name val="Consolas"/><family val="3"/></font><font><b/><sz val="11"/><color rgb="FF18181B"/><name val="Calibri"/><family val="2"/></font>${tones.map(([, fg]) => `<font><b/><sz val="10"/><color rgb="FF${fg}"/><name val="Calibri"/><family val="2"/></font>`).join('')}</fonts>
<fills count="${3 + tones.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF18181B"/><bgColor indexed="64"/></patternFill></fill>${tones.map(([bg]) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${bg}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE8E6E3"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${10 + tones.length}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
${tones.map((_, i) => `<xf numFmtId="0" fontId="${6 + i}" fillId="${3 + i}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>`).join('\n')}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ---------------------------------------------------------------- sheets
export type Cell = string | number | Date | null | undefined | { v: string | number | Date | null | undefined; s: number };
export type Sheet = { name: string; title: string; note: string; columns: { header: string; width: number }[]; rows: Cell[][] };

const x = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const serial = (d: Date) => d.getTime() / 86400000 + 25569;
function cell(ref: string, c: Cell, base: number) {
  const { v, s } = c !== null && typeof c === 'object' && !(c instanceof Date) ? c : { v: c, s: base };
  if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${s}"/>`;
  if (v instanceof Date) return `<c r="${ref}" s="${s === base ? S.date : s}"><v>${serial(v)}</v></c>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(String(v).slice(0, 32000))}</t></is></c>`;
}
function sheetXml(sh: Sheet) {
  const H = 4;   // title, note, blank, header
  const last = col(Math.max(0, sh.columns.length - 1));
  const rows = [
    `<row r="1" ht="28" customHeight="1">${cell('A1', { v: sh.title, s: S.title }, S.title)}</row>`,
    `<row r="2">${cell('A2', { v: sh.note, s: S.note }, S.note)}</row>`,
    `<row r="${H}" ht="30" customHeight="1">${sh.columns.map((c, i) => cell(`${col(i)}${H}`, { v: c.header, s: S.header }, S.header)).join('')}</row>`,
    ...sh.rows.map((r, ri) => `<row r="${H + 1 + ri}">${r.map((c, i) => cell(`${col(i)}${H + 1 + ri}`, c, S.text)).join('')}</row>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${H}" topLeftCell="A${H + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${sh.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${sh.rows.length ? `<autoFilter ref="A${H}:${last}${H + sh.rows.length}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}
const sheetName = (s: string, used: Set<string>) => { let n = s.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'; let i = 2; const base = n; while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${i++}`; used.add(n.toLowerCase()); return n; };

export function workbook(sheets: Sheet[], meta: { title: string; author: string }) {
  const used = new Set<string>(); const names = sheets.map((s) => sheetName(s.name, used));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(meta.title)}</dc:title><dc:creator>${x(meta.author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${sheets.some((s) => s.rows.length) ? `<definedNames>${sheets.map((s, i) => s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(names[i]).replace(/'/g, "''")}'!$A$4:$${col(s.columns.length - 1)}$${4 + s.rows.length}</definedName>` : '').join('')}</definedNames>` : ''}</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}
export const tone = (t: Tone) => S[t];
