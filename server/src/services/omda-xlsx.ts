import { deflateRawSync } from 'node:zlib';

export type XlsxCell = string | number | boolean | null | undefined;

const MAX_ROWS = 1000;
const MAX_COLUMNS = 64;
const MAX_CELL_CHARS = 4000;
const MAX_TOTAL_TEXT_CHARS = 250_000;
const MAX_ARCHIVE_BYTES = 2_000_000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function xmlText(value: string): string {
  const invalid = Array.from(value).some(character => {
    const code = character.codePointAt(0)!;
    return code <= 0x08 || code === 0x0b || code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe || code === 0xffff;
  });
  if (invalid) throw new TypeError('Cell contains characters that are not valid in XML');
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sheetTitle(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Invalid sheet name');
  let clean = value.trim();
  for (const forbidden of [String.fromCharCode(92), '/', '?', '*', ':', '[', ']']) {
    clean = clean.replaceAll(forbidden, '_');
  }
  while (clean.startsWith("'")) clean = clean.slice(1);
  while (clean.endsWith("'")) clean = clean.slice(0, -1);
  return clean.slice(0, 31) || 'OMDA';
}

function columnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellXml(value: XlsxCell, reference: string, header: boolean): string {
  const style = header ? ' s="1"' : '';
  if (value === null || value === undefined) return `<c r="${reference}"${style}/>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Cell number must be finite');
    return `<c r="${reference}"${style}><v>${Object.is(value, -0) ? '0' : String(value)}</v></c>`;
  }
  if (typeof value === 'boolean') return `<c r="${reference}" t="b"${style}><v>${value ? '1' : '0'}</v></c>`;
  if (typeof value !== 'string') throw new TypeError('Unsupported cell value');
  if (value.length > MAX_CELL_CHARS) throw new RangeError('Cell is too long');
  const escaped = xmlText(value);
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escaped}</t></is></c>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  content: string;
}

function zip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const compressed = deflateRawSync(raw, { level: 6 });
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function workbookEntries(columns: string[], rows: XlsxCell[][], name: string): ZipEntry[] {
  const sheetRows = [
    columns.map((value, index) => cellXml(value, `${columnName(index)}1`, true)).join(''),
    ...rows.map((row, rowIndex) => row.map((value, colIndex) =>
      cellXml(value, `${columnName(colIndex)}${rowIndex + 2}`, false),
    ).join('')),
  ];
  const lastColumn = columnName(columns.length - 1);
  const lastRow = rows.length + 1;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${sheetRows.map((cells, index) => `<row r="${index + 1}">${cells}</row>`).join('')}</sheetData>
</worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xmlText(name)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  return [
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRelationships },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: relationships },
    { name: 'xl/styles.xml', content: styles },
    { name: 'xl/worksheets/sheet1.xml', content: worksheet },
  ];
}

export function buildXlsx({
  columns,
  rows = [],
  sheetName = 'OMDA',
}: {
  columns: string[];
  rows?: XlsxCell[][];
  sheetName?: string;
}): Buffer {
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > MAX_COLUMNS) {
    throw new TypeError('Columns must contain between 1 and 64 entries');
  }
  if (!columns.every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 100)) {
    throw new TypeError('Every column must be a non-empty string of at most 100 characters');
  }
  const normalizedColumns = columns.map(value => value.trim());
  if (new Set(normalizedColumns.map(value => value.toLocaleLowerCase('en'))).size !== normalizedColumns.length) {
    throw new TypeError('Column names must be unique');
  }
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new RangeError('Workbook supports at most 1000 data rows');

  let totalText = normalizedColumns.reduce((sum, value) => sum + value.length, 0);
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== normalizedColumns.length) {
      throw new TypeError('Every row must have exactly the same number of cells as the columns');
    }
    for (const value of row) {
      if (value === null || value === undefined || typeof value === 'boolean') continue;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Cell number must be finite');
        continue;
      }
      if (typeof value !== 'string') throw new TypeError('Unsupported cell value');
      if (value.length > MAX_CELL_CHARS) throw new RangeError('Cell is too long');
      totalText += value.length;
      if (totalText > MAX_TOTAL_TEXT_CHARS) throw new RangeError('Workbook text limit exceeded');
    }
  }

  const title = sheetTitle(sheetName);
  const archive = zip(workbookEntries(normalizedColumns, rows, title));
  if (archive.length > MAX_ARCHIVE_BYTES) throw new RangeError('Generated workbook exceeds the 2 MB limit');
  return archive;
}

export const XLSX_CONTENT_TYPE = XLSX_MIME;
