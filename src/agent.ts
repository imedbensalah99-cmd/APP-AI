import type { JobApplication } from './types';

export interface AgentJob {
  company: string;
  role: string;
  location: string;
  sourceUrl: string;
  description: string;
}

const SIGNALS: { label: string; terms: RegExp }[] = [
  { label: 'AML', terms: /\bAML\b|anti.money.laundering/i },
  { label: 'KYC', terms: /\bKYC\b|know.your.customer/i },
  { label: 'CDD / EDD', terms: /\bCDD\b|\bEDD\b|due.diligence/i },
  { label: 'Transaction monitoring', terms: /transaction.monitoring/i },
  { label: 'Sanctions / PEP', terms: /sanctions?|\bPEP\b/i },
  { label: 'Fraud', terms: /fraud/i },
  { label: 'Compliance', terms: /complian(t|ce)/i },
  { label: 'Risk', terms: /\brisk\b/i },
  { label: 'Banking operations', terms: /banking.operations|back.office/i },
  { label: 'Finance / accounting', terms: /financial?\b|accounting|accounts.assistant/i },
  { label: 'Excel', terms: /\bExcel\b|spreadsheets?/i },
  { label: 'Data entry / records', terms: /data.entry|record(s)?.management|data.encoder/i },
  { label: 'Document control', terms: /document.control|documentation.coordinator/i },
  { label: 'Administration', terms: /administra(tive|tion)|office.coordinator/i },
  { label: 'Customer service', terms: /customer.service|customer.support/i },
  { label: 'Recruitment / HR', terms: /recruitment|human.resources|\bHR\b/i },
  { label: 'Arabic', terms: /arabic/i },
  { label: 'English', terms: /english/i },
  { label: 'French', terms: /french/i },
];

export function sameJob(a: Pick<AgentJob, 'company' | 'role'>, b: Pick<AgentJob, 'company' | 'role'>): boolean {
  const norm = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return !!norm(a.company) && !!norm(a.role) && norm(a.company) === norm(b.company) && norm(a.role) === norm(b.role);
}

export function analyzeJob(job: AgentJob, candidateFacts: string, existing: JobApplication[]) {
  const target = [job.role, job.description].join(' ');
  const matching = SIGNALS.filter(s => s.terms.test(target) && s.terms.test(candidateFacts)).map(s => s.label);
  const unverified = SIGNALS.filter(s => s.terms.test(target) && !s.terms.test(candidateFacts)).map(s => s.label);
  const concerns: string[] = [];
  if (/\b(senior|head|director|manager|chief|lead|mlro|dmlro)\b/i.test(job.role)) {
    concerns.push('Senior/management title: check experience requirements before applying.');
  }
  if (/qatarization|qatari nationals? only|qataris only|qatari citizens? only/i.test(target)) {
    concerns.push('Posting appears restricted to Qatari nationals: confirm eligibility.');
  }
  if (/\b(unpaid|registration fee|application fee)\b/i.test(target)) {
    concerns.push('Potential unpaid position or fee: investigate before proceeding.');
  }
  if (!job.description.trim()) concerns.push('Paste the full vacancy to assess requirements.');
  if (!candidateFacts.trim()) concerns.push('Add only factual CV details to assess skills and draft a tailored message.');
  if (!job.sourceUrl) concerns.push('An official vacancy URL is needed to verify this opportunity.');
  const duplicate = existing.some(app => sameJob(app, job) ||
    (!!job.sourceUrl && !!app.sourceUrl && job.sourceUrl.replace(/\/$/, '') === app.sourceUrl.replace(/\/$/, '')));
  if (duplicate) concerns.push('Possible duplicate found in this browser tracker. Check previous submissions.');
  return { matching, unverified, concerns, duplicate };
}

function safeLine(input: string, limit: number): string {
  return input.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function generateDraft(job: AgentJob, candidateFacts: string, fullName: string): string {
  const facts = candidateFacts.split(/\n|(?<=[.!?])\s+/).map(s => s.replace(/^\s*[-•]\s*/, '').trim())
    .filter(Boolean).slice(0, 4).map(line => '- ' + safeLine(line, 220));
  const displayRole = safeLine(job.role, 120) || '[JOB TITLE]';
  const company = safeLine(job.company, 120) || '[COMPANY]';
  const name = safeLine(fullName, 120) || '[YOUR NAME]';
  return [
    'Subject: Application – ' + displayRole + ' – ' + name,
    '',
    'Dear Hiring Team,',
    '',
    'I am writing to apply for the ' + displayRole + ' position at ' + company + '.',
    ...(facts.length ? ['', 'Relevant facts from my CV:', ...facts] : ['', '[ADD VERIFIED QUALIFICATIONS FROM YOUR CV]']),
    '',
    'I would welcome the opportunity to discuss how my background fits this role.',
    'Thank you for your consideration.',
    '',
    'Kind regards,',
    name,
    '',
    '[Attach your CV manually and verify the recipient before sending.]',
  ].join('\n');
}

export function isValidRecruiterEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
}
