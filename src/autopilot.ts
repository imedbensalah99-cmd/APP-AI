import { assessRequiredSkills, makeInitialCv, type CvSourceProfile, type TailoredCv } from './cvMaker';
import type { DiscoveredJob, ReviewDraft } from './discovery';
import type { JobApplication } from './types';

export type Suitability = 'prepare' | 'review' | 'exclude';

export interface JobDecision {
  job: DiscoveredJob;
  suitability: Suitability;
  explanation: string;
  direct: string[];
  transferable: string[];
  missing: string[];
}

const SENIOR = /\b(senior|sr\.?|lead|principal|head|director|manager|chief|vp|vice president|mlro|dmlro)\b/i;
const NATIONALITY = /qatari nationals? only|qataris only|qatarization only|qatari citizens? only/i;
const TARGET = /\b(aml|kyc|compliance|risk|fraud|financial crime|banking|transaction monitoring|sanctions|finance|accounting|accountant|operations|back.office|document.control|customer.service|customer.support|admin|data.entry|data.analyst|analyst)\b/i;
const DISALLOWED = /application fee|registration fee|pay to apply|unpaid internship/i;

function experienceRequirement(text: string): number {
  const matches = [...text.matchAll(/\b(\d{1,2})\s*(?:\+|to\s*\d{1,2}|-\s*\d{1,2})?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+|professional\s+|working\s+)?experience\b/gi)];
  return Math.max(0, ...matches.map(match => Number(match[1])));
}

export function assessForAutopilot(
  job: DiscoveredJob,
  facts: string,
  applied: JobApplication[] = [],
): JobDecision {
  const words = [job.role, job.description].join('\n');
  const skillAdvice = assessRequiredSkills(job, facts);
  const direct = skillAdvice.filter(s => s.fit === 'direct').map(s => s.skill);
  const transferable = skillAdvice.filter(s => s.fit === 'related').map(s => s.skill);
  const missing = skillAdvice.filter(s => s.fit === 'unsupported').map(s => s.skill);
  const base = { job, direct, transferable, missing };
  const exists = applied.some(a => (a.sourceUrl && a.sourceUrl === job.sourceUrl) ||
    (a.company.trim().toLowerCase() === job.company.trim().toLowerCase() &&
     a.role.trim().toLowerCase() === job.role.trim().toLowerCase()));
  if (exists) return { ...base, suitability: 'exclude', explanation: 'Already present in your application tracker.' };
  if (SENIOR.test(job.role)) return { ...base, suitability: 'exclude', explanation: 'Senior or management-level title excluded.' };
  if (NATIONALITY.test(words)) return { ...base, suitability: 'exclude', explanation: 'Appears limited to Qatari nationals.' };
  if (DISALLOWED.test(words)) return { ...base, suitability: 'exclude', explanation: 'Unpaid role or application fee risk.' };
  if (experienceRequirement(words) >= 7) return { ...base, suitability: 'exclude', explanation: 'Job appears to require at least seven years of experience.' };
  if (!facts.trim()) return { ...base, suitability: 'review', explanation: 'Verified CV profile missing. Add it once to enable automated drafting.' };
  if (!job.description.trim()) return { ...base, suitability: 'review', explanation: 'Job details missing; cannot assess requirements reliably.' };
  if (!TARGET.test(job.role)) return { ...base, suitability: 'review', explanation: 'Role title is not clearly aligned with your target career areas.' };
  if (experienceRequirement(words) >= 5) return { ...base, suitability: 'review', explanation: 'Five or more years requested: confirm eligibility before applying.' };
  if (missing.some(s => /certification/i.test(s)) &&
      /\b(?:CAMS|CPA)(?:\s+certification)?\s+(?:is\s+)?(?:required|mandatory)\b|\b(?:must\s+have|requires?)\s+(?:a\s+)?(?:CAMS|CPA)\b/i.test(words))
    return { ...base, suitability: 'review', explanation: 'A required certification is not evidenced by your CV.' };
  if (/\b(?:US|USA|United States)\s+(?:residents|citizens|only)\b|must\s+(?:live|reside)\s+in\s+(?:the\s+)?(?:US|USA|United States)\b/i.test(words))
    return { ...base, suitability: 'review', explanation: 'Posting may restrict applicants outside the United States.' };
  if (direct.length >= 2) {
    return { ...base, suitability: 'prepare', explanation: direct.length + ' relevant requirements directly mentioned in CV. Review employer eligibility.' };
  }
  return { ...base, suitability: 'review', explanation: 'Insufficient direct CV evidence for automatic drafting; inspect transferable skills.' };
}

function compact(value: string, max: number) {
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function draftForAutopilot(job: DiscoveredJob, cv: CvSourceProfile) {
  const advice = assessRequiredSkills(job, [cv.verifiedFacts, cv.education, cv.certifications].join('\n'));
  const supported: string[] = [];
  for (const s of advice) {
    if (s.fit !== 'direct' || !s.evidence) continue;
    const evidence = compact(s.evidence, 240);
    if (!supported.includes(evidence)) supported.push(evidence);
  }
  const facts = supported.slice(0, 3).map(text => '- ' + text);
  if (!facts.length) facts.push('- ' + compact(cv.verifiedFacts.split('\n')[0] || cv.headline, 230));
  return [
    'Subject: Application – ' + compact(job.role, 105),
    '',
    'Dear Recruitment Team,',
    '',
    'I am interested in the ' + compact(job.role, 105) + ' opportunity at ' + compact(job.company, 100) + '.',
    'My professional background includes:',
    ...facts,
    '',
    'I would welcome the opportunity to discuss my suitability for the role. Please find my CV attached for review.',
    '',
    'Kind regards,',
    compact(cv.fullName, 120),
  ].join('\n');
}

export function prepareAutopilot(
  items: DiscoveredJob[],
  cv: CvSourceProfile,
  existingDrafts: ReviewDraft[],
  applications: JobApplication[],
  now = new Date().toISOString(),
) {
  const seenUrls = new Set(existingDrafts.map(d => d.job.sourceUrl));
  const decisions: JobDecision[] = [];
  const newDrafts: ReviewDraft[] = [];
  const tailoredCvs: Record<string, TailoredCv> = {};
  for (const job of items) {
    const decision = assessForAutopilot(job, [cv.verifiedFacts, cv.education, cv.certifications].join('\n'), applications);
    decisions.push(decision);
    if (decision.suitability !== 'prepare' || seenUrls.has(job.sourceUrl) ||
        !cv.fullName.trim() || !cv.verifiedFacts.trim()) continue;
    newDrafts.push({
      id: job.id, job, recipient: '', body: draftForAutopilot(job, cv),
      status: 'Draft', preparedAt: now,
    });
    tailoredCvs[job.sourceUrl] = makeInitialCv(job, cv, now);
    seenUrls.add(job.sourceUrl);
  }
  return { decisions, newDrafts, tailoredCvs };
}
