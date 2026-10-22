import { describe, expect, it, vi } from 'vitest';
import { normalizeHimalayas, parseImportedJobs, rankLead, searchJobFeeds, uniqueLeads } from './discovery';
import type { JobApplication } from './types';
const now = Date.parse('2026-10-22T12:00:00Z');
const listing = {
  guid: 'https://himalayas.app/companies/bank/jobs/aml-analyst',
  title: 'AML Analyst', companyName: 'Example Finance',
  applicationLink: 'https://himalayas.app/companies/bank/jobs/aml-analyst',
  description: '<p>AML, transaction monitoring and KYC</p>',
  pubDate: Math.floor(now / 1000) - 86400,
  expiryDate: Math.floor(now / 1000) + 86400 * 20,
  locationRestrictions: [{ alpha2: 'QA', name: 'Qatar' }],
};
const tracked: JobApplication = {
  id: '1', company: 'Example Finance', role: 'AML Analyst', status: 'Applied',
  location: 'Doha', sourceUrl: listing.applicationLink, appliedOn: '2026-10-20',
  deadline: '', followUpOn: '', notes: '', createdAt: '', updatedAt: '',
};
describe('free job discovery', () => {
  it('loads only current relevant Qatar-eligible or worldwide positions', () => {
    const data = { jobs: [
      listing,
      { ...listing, guid: 'another', title: 'Senior AML Analyst' },
      { ...listing, guid: 'us', title: 'Compliance Officer', locationRestrictions: [{ alpha2: 'US', name: 'United States' }] },
      { ...listing, guid: 'old', title: 'Finance Analyst', pubDate: Math.floor(now / 1000) - 70 * 86400 },
      { ...listing, guid: 'closed', title: 'Operations Analyst', expiryDate: Math.floor(now / 1000) - 100 },
      { ...listing, guid: 'invalid', title: 'Data Analyst', applicationLink: 'javascript:alert(1)' },
      { ...listing, guid: 'worldwide', title: 'Finance Assistant', locationRestrictions: [] },
    ] };
    const items = normalizeHimalayas(data, now);
    expect(items).toHaveLength(2);
    expect(items[0].company).toBe('Example Finance');
    expect(items[1].location).toMatch(/worldwide/);
  });
  it('rejects fabricated/invalid import fields', () => {
    expect(parseImportedJobs(JSON.stringify([
      { company: 'Valid Bank', role: 'AML Analyst', sourceUrl: 'https://example.org/job' },
      { company: 'Invalid', role: 'Analyst', sourceUrl: 'javascript:alert(1)' },
    ]))).toHaveLength(1);
    expect(() => parseImportedJobs('not json')).toThrow();
    expect(() => normalizeHimalayas({ jobs: {} })).toThrow();
  });
  it('removes duplicates against both existing jobs and the tracker', () => {
    const job = normalizeHimalayas({ jobs: [listing] }, now)[0];
    expect(uniqueLeads([job, job])).toHaveLength(1);
    expect(uniqueLeads([job], [tracked])).toHaveLength(0);
  });
  it('uses CV keyword overlap without invented percentages', () => {
    const job = normalizeHimalayas({ jobs: [listing] }, now)[0];
    const rank = rankLead(job, 'AML transaction monitoring', []);
    expect(rank.score).toBeGreaterThanOrEqual(2);
    expect(rank.scoreLabel).toContain('CV skill matches');
  });
  it('requests the live source rather than hardcoding job listings', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [listing] }) });
    const jobs = await searchJobFeeds(fakeFetch as unknown as typeof fetch, 'AML');
    expect(fakeFetch).toHaveBeenCalledOnce();
    const address = String(fakeFetch.mock.calls[0][0]);
    expect(address).toContain('himalayas.app/jobs/api/search');
    expect(address).toContain('country=QA');
    expect(jobs.length).toBeGreaterThan(0);
  });
});
