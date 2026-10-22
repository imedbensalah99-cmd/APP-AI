import { describe, expect, it } from 'vitest';
import { analyzeJob, generateDraft, isValidRecruiterEmail, parseCvProfileFragment, sameJob, type AgentJob } from './agent';
import type { JobApplication } from './types';

const job: AgentJob = {
  company: 'Example Bank', role: 'AML Analyst', location: 'Doha, Qatar',
  sourceUrl: 'https://example.org/careers/aml',
  description: 'AML transaction monitoring and KYC knowledge required. Qatari nationals only.',
};
const old: JobApplication = {
  ...job, id: '1', status: 'Applied', appliedOn: '2026-10-20',
  deadline: '', followUpOn: '', notes: '', createdAt: '', updatedAt: '',
};

describe('application agent', () => {
  it('only reports skills supported by candidate notes', () => {
    const result = analyzeJob(job, 'Experience with AML transaction monitoring and Excel.', []);
    expect(result.matching).toEqual(expect.arrayContaining(['AML', 'Transaction monitoring']));
    expect(result.unverified).toContain('KYC');
    expect(result.concerns.join(' ')).toMatch(/Qatari nationals/);
    expect(result.duplicate).toBe(false);
  });
  it('detects duplicates regardless of prior application date', () => {
    expect(sameJob(job, { ...job, company: 'example bank', role: 'AML-Analyst' })).toBe(true);
    expect(analyzeJob(job, 'AML', [old]).duplicate).toBe(true);
  });
  it('flags unsuitable senior positions without assuming eligibility', () => {
    expect(analyzeJob({ ...job, role: 'Head of Compliance' }, 'compliance', []).concerns.join(' ')).toMatch(/Senior/);
  });
  it('drafts without inventing unsupported experience or sending', () => {
    const draft = generateDraft(job, 'AML analysis\nExcel skills', 'Test Candidate');
    expect(draft).toContain('AML analysis');
    expect(draft).toContain('Excel skills');
    expect(draft).toContain('[Attach your CV manually');
    expect(draft).not.toContain('bachelor');
    expect(draft).toContain('Test Candidate');
  });
  it('imports validated CV profile facts from a temporary hash only', () => {
    const profile = { name: 'Test Candidate', facts: 'Worked in AML and KYC.' };
    const imported = parseCvProfileFragment('#cv=' + encodeURIComponent(JSON.stringify(profile)));
    expect(imported).toEqual({ fullName: 'Test Candidate', facts: 'Worked in AML and KYC.' });
    expect(parseCvProfileFragment('#main')).toBeNull();
    expect(parseCvProfileFragment('#cv=%7Bmalformed')).toBeNull();
    expect(parseCvProfileFragment('#cv=' + encodeURIComponent(JSON.stringify({ name: '', facts: 'x' })))).toBeNull();
  });
  it('requires a syntactically valid recruiter email', () => {
    expect(isValidRecruiterEmail('recruitment@example.org')).toBe(true);
    expect(isValidRecruiterEmail('hr@')).toBe(false);
  });
});
