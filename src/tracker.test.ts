import { describe, expect, it } from 'vitest';
import { cleanFields, duplicateKey, isValidDate, needsAttention, normalizeRecord, readApplications, saveApplications, todayLocal, validWebUrl } from './data';
import { exportCsv, importCsv, parseCsv } from './csv';
import type { JobApplication } from './types';

const example: JobApplication = {
  id: '1', company: 'Example Bank', role: 'AML Analyst', status: 'Applied',
  location: 'Doha', sourceUrl: 'https://example.org/job',
  appliedOn: '2026-10-01', deadline: '', followUpOn: '2026-10-20',
  notes: 'Phone screen, "awaiting" response', createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('application validation and storage', () => {
  it('requires company and role and rejects non-http links', () => {
    expect(cleanFields({ company: 'A', role: ' B ', status: 'Applied', sourceUrl: 'javascript:alert(1)' })?.sourceUrl).toBe('');
    expect(cleanFields({ company: '', role: 'Developer' })).toBeNull();
    expect(validWebUrl('https://example.com/')).toBe('https://example.com/');
  });
  it('validates dates including leap dates', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2025-02-29')).toBe(false);
    expect(isValidDate('2026-01-35')).toBe(false);
  });
  it('normalizes bad input without exceptions', () => {
    expect(normalizeRecord({ company: '  Bank ', role: 'Analyst', status: 'unknown', deadline: '2026-99-99' })).toMatchObject({
      company: 'Bank', role: 'Analyst', status: 'Wishlist', deadline: '',
    });
    expect(normalizeRecord(null)).toBeNull();
  });
  it('loads a saved versioned record and handles corrupt data', () => {
    let data = '';
    const storage = {
      getItem: () => data,
      setItem: (_key: string, value: string) => { data = value; },
    };
    expect(saveApplications(storage, [example])).toBe(true);
    expect(readApplications(storage)).toHaveLength(1);
    data = '{not-json';
    expect(readApplications(storage)).toEqual([]);
  });
  it('flags due follow-ups and wishlist deadlines but not closed applications', () => {
    expect(needsAttention(example, '2026-10-22')).toBe(true);
    expect(needsAttention({ ...example, status: 'Offer' }, '2026-10-22')).toBe(false);
    expect(needsAttention({ ...example, status: 'Wishlist', followUpOn: '', deadline: '2026-10-20' }, '2026-10-22')).toBe(true);
    expect(todayLocal(new Date(2026, 9, 22))).toBe('2026-10-22');
  });
});

describe('CSV handling', () => {
  it('round-trips quotes, commas and multiline notes', () => {
    const job = { ...example, notes: 'First line,\n"second" line' };
    const csv = exportCsv([job]);
    const parsed = importCsv(csv, []);
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].notes).toBe(job.notes);
    expect(parsed.added[0].role).toBe('AML Analyst');
  });
  it('prevents spreadsheet formula injection on export', () => {
    const csv = exportCsv([{ ...example, company: '=HYPERLINK("unsafe")' }]);
    expect(csv).toContain("'=HYPERLINK");
  });
  it('skips duplicates both in imports and existing records', () => {
    const csv = exportCsv([example, example]);
    expect(importCsv(csv, [example]).added).toHaveLength(0);
    const result = importCsv(csv, []);
    expect(result.added).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(duplicateKey(example)).toBe(duplicateKey({ ...example, company: 'example bank' }));
  });
  it('rejects malformed and wrong-header CSV files', () => {
    expect(() => parseCsv('name,company\n"unfinished')).toThrow(/unclosed/);
    expect(() => importCsv('wrong,header\nx,y', [])).toThrow(/company and role/);
  });
});
