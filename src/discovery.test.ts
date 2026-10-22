import { describe, expect, it } from 'vitest';
import { loadDrafts, makeDraft, normalizeFeed, normalizeJob } from './discovery';

const job = {
  id: 'himalayas:test', company: 'Example Bank', role: 'AML Analyst',
  sourceUrl: 'https://himalayas.app/example', location: 'Remote',
  description: 'AML and KYC', source: 'Himalayas',
  postedAt: '2026-10-22T09:00:00Z', kind: 'remote', verification: 'board-listing',
};

describe('public feed and application review queue', () => {
  it('parses and deduplicates real-shaped job feed records', () => {
    const result = normalizeFeed({ generatedAt: '2026-10-22T10:00:00Z', jobs: [job, job], errors: [] });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].role).toBe('AML Analyst');
    expect(result.jobs[0].verification).toBe('board-listing');
  });
  it('does not invent jobs or accept scripts as application URLs', () => {
    expect(normalizeJob({ ...job, sourceUrl: 'javascript:alert(1)' })).toBeNull();
    expect(normalizeFeed({ generatedAt: 'x', jobs: [] }).jobs).toEqual([]);
    expect(() => normalizeFeed({ jobs: [] })).toThrow(/expected format/);
  });
  it('builds a local, unsent draft only from CV-supported facts', () => {
    const record = normalizeJob(job)!;
    const draft = makeDraft(record, 'Transaction monitoring and KYC.\nBachelor in Finance.', 'Example Candidate');
    expect(draft.body).toContain('Transaction monitoring and KYC');
    expect(draft.body).toContain('Example Candidate');
    expect(draft.state).toBe('ready');
    expect(draft.email).toBe('');
    expect(draft.body).not.toContain('10 years');
  });
  it('keeps user-reported state separate from verified delivery', () => {
    const draft = { ...makeDraft(normalizeJob(job)!, 'AML', 'Test'), state: 'reported-sent' as const };
    const storage = { getItem: () => JSON.stringify([draft, { ...draft, job: { ...job, sourceUrl: 'file:///bad' } }]) };
    expect(loadDrafts(storage, 'my-key')).toHaveLength(1);
    expect(loadDrafts({ getItem: () => 'broken' }, 'my-key')).toEqual([]);
  });
  it('marks local Qatar news as unverified leads', () => {
    const result = normalizeJob({ ...job, id: 'qatar:test', kind: 'qatar-lead', verification: 'unverified-lead' });
    expect(result?.verification).toBe('unverified-lead');
  });
});
