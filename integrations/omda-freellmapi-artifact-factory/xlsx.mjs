// OMDA FreeLLMAPI: genuine dependency-free OOXML XLSX generator.
// Works in Node.js and an offline mobile browser. No network, scripts or macros.
// All imported user values are literal cells, never formulas.
const encoder = new TextEncoder();
const MAX_ROWS = 1000, MAX_COLS = 20;
const utf8 = value => encoder.encode(value);
function esc(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}
function cell(ref, value, style = 0) {
  const attr = ' r="' + ref + '" s="' + style + '"';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Invalid numeric cell');
    return '<c' + attr + '><v>' + String(value) + '</v></c>';
  }
  if (typeof value === 'boolean') return '<c' + attr + ' t="b"><v>' + (value ? 1 : 0) + '</v></c>';
  return '<c' + attr + ' t="inlineStr"><is><t xml:space="preserve">' +
    esc(value == null ? '' : value) + '</t></is></c>';
}
function formula(ref, expression) {
  // Only hardcoded formula construction in this module calls this helper.
  return '<c r="' + ref + '" s="2"><f>' + esc(expression) + '</f><v></v></c>';
}
function worksheet(headers, rows) {
  const last = Math.max(2, rows.length + 1);
  const end = colName(headers.length - 1);
  const data = ['<row r="1" ht="27" customHeight="1">' +
    headers.map((h, i) => cell(colName(i) + '1', h, 1)).join('') + '</row>'];
  rows.forEach((row, i) => {
    const rowNo = i + 2;
    data.push('<row r="' + rowNo + '">' + headers.map((h, j) =>
      cell(colName(j) + rowNo, Object.prototype.hasOwnProperty.call(row, h) ? row[h] : '')).join('') + '</row>');
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:' + end + last + '"/><sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>' +
    '<cols>' + headers.map((h, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) +
    '" width="' + Math.max(12, Math.min(40, String(h).length + 8)) + '" customWidth="1"/>').join('') +
    '</cols><sheetData>' + data.join('') + '</sheetData><autoFilter ref="A1:' + end +
    (rows.length + 1) + '"/></worksheet>';
}
function summarySheet(rows, headers) {
  const range = "Data!A2:A" + Math.max(2, rows.length + 1);
  const statusColumn = headers.findIndex(h => String(h).toLowerCase() === 'status');
  const statusRef = statusColumn < 0 ? null :
    'Data!' + colName(statusColumn) + '2:' + colName(statusColumn) + Math.max(2, rows.length + 1);
  const r = [
    '<row r="1">' + cell('A1', 'OMDA / Summary', 1) + '</row>',
    '<row r="2">' + cell('A2', 'Data rows') + formula('B2', 'COUNTA(' + range + ')') + '</row>',
    '<row r="3">' + cell('A3', 'Source') + cell('B3', 'Data worksheet; no external connections') + '</row>'
  ];
  if (statusRef) r.push('<row r="4">' + cell('A4', 'Completed') +
    formula('B4', 'COUNTIF(' + statusRef + ',"Completed")') + '</row>');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    '<cols><col min="1" max="1" width="24" customWidth="1"/>' +
    '<col min="2" max="2" width="45" customWidth="1"/></cols><sheetData>' +
    r.join('') + '</sheetData></worksheet>';
}
// ZIP method 0: portable STORED archives with a checked central directory.
// Deterministic timestamps and no input-controlled archive member names.
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  if (files.length > 16) throw Error('Too many workbook parts');
  const entries = [];
  let offset = 0, size = 22;
  for (const [name, xml] of files) {
    if (!/^[A-Za-z0-9_./\[\]-]+$/.test(name) || name.includes('..') || name.startsWith('/'))
      throw Error('Invalid OOXML part path');
    const n = utf8(name), b = utf8(xml);
    if (b.length > 2 * 1024 * 1024) throw Error('Workbook part too large');
    const entry = {n, b, crc: crc32(b), offset};
    entries.push(entry);
    offset += 30 + n.length + b.length;
    size += 46 + n.length;
  }
  size += offset;
  if (size > 4 * 1024 * 1024) throw Error('Workbook too large');
  const out = new Uint8Array(size), view = new DataView(out.buffer);
  let p = 0;
  const u16 = n => {view.setUint16(p, n, true); p += 2;};
  const u32 = n => {view.setUint32(p, n, true); p += 4;};
  const copy = bytes => {out.set(bytes, p); p += bytes.length;};
  for (const e of entries) {
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(0); u16(0);
    u32(e.crc); u32(e.b.length); u32(e.b.length); u16(e.n.length); u16(0);
    copy(e.n); copy(e.b);
  }
  const centralOffset = p;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(0);
    u32(e.crc); u32(e.b.length); u32(e.b.length); u16(e.n.length);
    u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset); copy(e.n);
  }
  const centralSize = p - centralOffset;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length);
  u32(centralSize); u32(centralOffset); u16(0);
  if (p !== size) throw Error('ZIP size validation failed');
  return out;
}
function xlsx(rows, title = '') {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw Error('Too many workbook rows');
  const headers = rows.length ? [...new Set(rows.flatMap(r => Object.keys(r)))] :
    ['Task', 'Owner', 'Status', 'Notes'];
  if (!headers.length || headers.length > MAX_COLS) throw Error('Invalid workbook columns');
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Invalid workbook row');
    for (const value of Object.values(row)) {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw Error('Invalid workbook value');
      if (typeof value === 'string' && value.length > 2000) throw Error('Workbook value too long');
      if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Invalid numeric cell');
    }
  }
  const data = rows.length ? rows : [{Task:'Review generated template', Owner:'', Status:'Draft', Notes:'Synthetic template; no real records'}];
  const parts = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF35205D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', worksheet(headers, data)],
    ['xl/worksheets/sheet2.xml', summarySheet(data, headers)]
  ];
  void title; // Title remains in the existing command manifest, never inserted as unsanitized XML.
  return zip(parts);
}
export {xlsx, MAX_ROWS, MAX_COLS};
