import { cleanFields, createApplication, duplicateKey } from './data';
import { STATUSES, type JobApplication } from './types';

export const CSV_HEADERS = [
  'company', 'role', 'status', 'location', 'sourceUrl',
  'appliedOn', 'deadline', 'followUpOn', 'notes',
] as const;

function csvCell(value: string): string {
  // Avoid spreadsheet formula execution when a user opens exported CSV in Excel/Sheets.
  const protectedValue = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
  return '"' + protectedValue.replace(/"/g, '""') + '"';
}

export function exportCsv(apps: JobApplication[]): string {
  const rows = apps.map(app => CSV_HEADERS.map(key => csvCell(app[key])).join(','));
  return '\uFEFF' + [CSV_HEADERS.join(','), ...rows].join('\r\n') + '\r\n';
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { value += '"'; i += 1; }
        else { quoted = false; closedQuote = true; }
      } else { value += ch; }
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(value);
      value = '';
      closedQuote = false;
      if (ch !== ',') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
      }
    } else if (ch === '"' && value === '' && !closedQuote) {
      quoted = true;
    } else {
      if (closedQuote) throw new Error('Unexpected characters after a quoted CSV field.');
      value += ch;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (value !== '' || row.length > 0) {
    row.push(value);
    if (row.some(cell => cell !== '')) rows.push(row);
  }
  return rows;
}

export function importCsv(input: string, existing: JobApplication[]): { added: JobApplication[]; skipped: number } {
  const rows = parseCsv(input);
  if (!rows.length) throw new Error('The CSV file is empty.');
  const header = rows[0].map(item => item.trim());
  if (!header.includes('company') || !header.includes('role')) {
    throw new Error('CSV requires company and role columns. Export a sample from this app first.');
  }
  const known = new Set(existing.map(duplicateKey));
  const added: JobApplication[] = [];
  let skipped = 0;
  for (const cells of rows.slice(1)) {
    const value: Record<string, string> = {};
    header.forEach((key, index) => { value[key] = cells[index] ?? ''; });
    if (!STATUSES.includes(value.status as JobApplication['status'])) value.status = 'Wishlist';
    const cleaned = cleanFields(value);
    if (!cleaned) { skipped += 1; continue; }
    const key = duplicateKey(cleaned);
    if (known.has(key)) { skipped += 1; continue; }
    known.add(key);
    added.push(createApplication(cleaned));
  }
  return { added, skipped };
}
