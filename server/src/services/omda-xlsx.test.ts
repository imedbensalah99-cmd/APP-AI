import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx, XLSX_CONTENT_TYPE } from './omda-xlsx.js';

function readLocalZipEntries(archive: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed) : compressed;
    files.set(name, content.toString('utf8'));
    offset = dataStart + compressedSize;
  }
  return files;
}

describe('OMDA XLSX generator', () => {
  it('creates a valid OOXML ZIP package with a readable worksheet', () => {
    const archive = buildXlsx({
      sheetName: 'متابعة الوظائف',
      columns: ['Company', 'Role', 'Status'],
      rows: [['Gulf Exchange', 'AML Analyst', 'Draft'], ['Example', 'Compliance', 'Research']],
    });
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(XLSX_CONTENT_TYPE).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const files = readLocalZipEntries(archive);
    expect([...files.keys()]).toContain('[Content_Types].xml');
    expect([...files.keys()]).toContain('xl/workbook.xml');
    expect(files.get('xl/workbook.xml')).toContain('متابعة الوظائف');
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('AML Analyst');
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
  });

  it('writes strings as inline text, never as executable spreadsheet formulas', () => {
    const archive = buildXlsx({ columns: ['Input'], rows: [['=HYPERLINK("https://evil.invalid")']] });
    const sheet = readLocalZipEntries(archive).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('&quot;https://evil.invalid&quot;');
  });

  it('preserves number, boolean and blank cell types', () => {
    const archive = buildXlsx({ columns: ['Count', 'Enabled', 'Notes'], rows: [[12, true, null]] });
    const sheet = readLocalZipEntries(archive).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<v>12</v>');
    expect(sheet).toContain('t="b"><v>1</v>');
    expect(sheet).toContain('<c r="C2"/>');
  });

  it('escapes XML text and keeps right-to-left Unicode content', () => {
    const archive = buildXlsx({ columns: ['المسمى'], rows: [['محلل امتثال & AML <Qatar>']] });
    const sheet = readLocalZipEntries(archive).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('محلل امتثال &amp; AML &lt;Qatar&gt;');
  });

  it('sanitizes invalid worksheet title characters and caps the title', () => {
    const archive = buildXlsx({ sheetName: "Bad/Name:*?[]'".repeat(4), columns: ['A'] });
    const workbook = readLocalZipEntries(archive).get('xl/workbook.xml')!;
    expect(workbook).not.toContain('Bad/Name');
    expect(workbook).toContain('sheetId="1"');
  });

  it('rejects duplicate columns, ragged rows and invalid cell values', () => {
    expect(() => buildXlsx({ columns: ['Name', 'name'] })).toThrow(/unique/);
    expect(() => buildXlsx({ columns: ['A', 'B'], rows: [['only one']] })).toThrow(/exactly/);
    expect(() => buildXlsx({ columns: ['A'], rows: [[Number.NaN]] })).toThrow(/finite/);
    expect(() => buildXlsx({ columns: ['A'], rows: [[{} as never]] })).toThrow(/Unsupported/);
  });

  it('enforces row, column, cell and XML control-character bounds', () => {
    expect(() => buildXlsx({ columns: ['A'], rows: Array.from({ length: 1001 }, () => ['x']) })).toThrow(/1000/);
    expect(() => buildXlsx({ columns: Array.from({ length: 65 }, (_, i) => String(i)) })).toThrow(/64/);
    expect(() => buildXlsx({ columns: ['A'], rows: [['x'.repeat(4001)]] })).toThrow(/too long/);
    expect(() => buildXlsx({ columns: ['A'], rows: [['bad\u0001text']] })).toThrow(/XML/);
  });
});
