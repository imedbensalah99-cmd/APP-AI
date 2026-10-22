import type { DiscoveredJob } from './discovery';

export type SkillFit = 'direct' | 'related' | 'unsupported';

export interface SkillAdvice {
  skill: string;
  fit: SkillFit;
  evidence: string;
  guidance: string;
}

interface SkillRule {
  name: string;
  need: RegExp;
  direct: RegExp;
  related?: RegExp;
}

const RULES: SkillRule[] = [
  { name: 'AML / Anti-money laundering', need: /\bAML\b|anti.money.laundering/i, direct: /\bAML\b|anti.money.laundering/i, related: /\bKYC\b|compliance/i },
  { name: 'KYC', need: /\bKYC\b|know.your.customer/i, direct: /\bKYC\b|know.your.customer/i, related: /\bCDD\b|customer.due.diligence/i },
  { name: 'Customer due diligence (CDD)', need: /\bCDD\b|customer.due.diligence/i, direct: /\bCDD\b|customer.due.diligence/i, related: /\bKYC\b|onboarding/i },
  { name: 'Enhanced due diligence (EDD)', need: /\bEDD\b|enhanced.due.diligence/i, direct: /\bEDD\b|enhanced.due.diligence/i, related: /\bCDD\b|\bKYC\b|customer.due.diligence/i },
  { name: 'Transaction monitoring', need: /transaction.monitoring|monitoring.transactions?/i, direct: /transaction.monitoring|monitoring.transactions?/i, related: /AML.alerts?|suspicious.activity/i },
  { name: 'Suspicious transaction reporting (SAR/STR)', need: /\bSAR\b|\bSTR\b|suspicious.(activity|transaction).reports?/i, direct: /\bSAR\b|\bSTR\b|suspicious.(activity|transaction).reports?/i, related: /transaction.monitoring|AML.case/i },
  { name: 'Sanctions screening', need: /sanctions?.screen|sanctions?.check|sanctions?.compliance/i, direct: /sanctions?.(screen|check)|screening.{0,50}sanctions?/i, related: /PEP.screen|\bKYC\b|compliance/i },
  { name: 'PEP screening', need: /\bPEP\b|politically.exposed.person/i, direct: /\bPEP\b|politically.exposed.person/i, related: /sanctions?.screen|\bKYC\b/i },
  { name: 'Fraud analysis', need: /fraud.(analysis|analyst|monitor|detect|investigat|prevent)|fraud.risk/i, direct: /fraud.(analysis|analyst|monitor|detect|investigat|prevent)|fraud.risk/i, related: /transaction.monitoring|suspicious.activity|AML.alert/i },
  { name: 'Risk assessment', need: /risk.assess|risk.analys|risk.rating|risk.management/i, direct: /risk.assess|risk.analys|risk.rating|risk.management/i, related: /customer.due.diligence|\bCDD\b|\bKYC\b|screening/i },
  { name: 'Microsoft Excel', need: /\bExcel\b|spreadsheet/i, direct: /\bExcel\b|spreadsheet/i, related: /data.analysis|financial.reporting|reconcil/i },
  { name: 'SQL', need: /\bSQL\b|structured.query.language/i, direct: /\bSQL\b|structured.query.language/i, related: /Excel|data.analysis/i },
  { name: 'Python programming', need: /\bPython\b|pandas\b/i, direct: /\bPython\b|pandas\b/i, related: /Excel|data.analysis/i },
  { name: 'Power BI', need: /Power.BI|business.intelligence.dashboard/i, direct: /Power.BI|business.intelligence.dashboard/i, related: /Excel|reporting|data.analysis/i },
  { name: 'Financial reporting', need: /financial.report|financial.statement|balance.sheet/i, direct: /financial.report|financial.statement|balance.sheet/i, related: /accounting|reconcil/i },
  { name: 'Accounting / reconciliation', need: /accounting|reconcil|bookkeeping/i, direct: /accounting|reconcil|bookkeeping/i, related: /finance|financial.report|balance.sheet/i },
  { name: 'Document control', need: /document.control|document.management|records.management/i, direct: /document.control|document.management|records.management/i, related: /case.files?|supporting.documentation|compliance.records?|data.quality/i },
  { name: 'Customer service', need: /customer.service|customer.support|client.service/i, direct: /customer.service|customer.support|client.service/i, related: /customer.facing|walk.in.customers?|sales.executive|clients/i },
  { name: 'Administrative support', need: /administrative.support|admin.assistant|office.administrat/i, direct: /administrative.support|admin.assistant|office.administrat/i, related: /record|case.files?|report|correspondence|documentation/i },
  { name: 'CAMS certification', need: /\bCAMS\b|certified.anti.money.laundering.specialist/i, direct: /\bCAMS\b|certified.anti.money.laundering.specialist/i },
  { name: 'CPA certification', need: /\bCPA\b|certified.public.accountant/i, direct: /\bCPA\b|certified.public.accountant/i },
];

export interface CvSourceProfile {
  fullName: string;
  headline: string;
  contact: string;
  verifiedFacts: string;
  education: string;
  certifications: string;
  languages: string;
}

export interface TailoredCv {
  sourceUrl: string;
  role: string;
  company: string;
  profile: CvSourceProfile;
  selectedSkills: string[];
  updatedAt: string;
}

export function findEvidence(source: string, expression: RegExp): string {
  const parts = source.split(/\n|(?<=[.!?])\s+/).map(p => p.trim()).filter(Boolean);
  return (parts.find(part => expression.test(part)) || '').slice(0, 300);
}

export function assessRequiredSkills(job: Pick<DiscoveredJob, 'role' | 'description'>, facts: string): SkillAdvice[] {
  const text = [job.role, job.description].join('\n');
  const output: SkillAdvice[] = [];
  for (const rule of RULES) {
    if (!rule.need.test(text)) continue;
    const directEvidence = findEvidence(facts, rule.direct);
    if (directEvidence) {
      output.push({
        skill: rule.name, fit: 'direct', evidence: directEvidence,
        guidance: 'Your supplied CV mentions this skill. Highlight only the experience you can substantiate.',
      });
      continue;
    }
    const relatedEvidence = rule.related ? findEvidence(facts, rule.related) : '';
    if (relatedEvidence) {
      output.push({
        skill: rule.name, fit: 'related', evidence: relatedEvidence,
        guidance: 'Transferable experience, NOT proof of the requested skill. Mention the existing experience without claiming proficiency in ' + rule.name + '.',
      });
    } else {
      output.push({
        skill: rule.name, fit: 'unsupported', evidence: '',
        guidance: 'Not evidenced in your saved CV. Do not add this as a qualification. Training or verified experience may be needed.',
      });
    }
  }
  return output;
}

export function makeInitialCv(job: DiscoveredJob, profile: CvSourceProfile, now = new Date().toISOString()): TailoredCv {
  const advice = assessRequiredSkills(job, [profile.verifiedFacts, profile.education, profile.certifications].join('\n'));
  return {
    sourceUrl: job.sourceUrl, role: job.role, company: job.company,
    profile: { ...profile },
    selectedSkills: advice.filter(a => a.fit === 'direct').map(a => a.skill),
    updatedAt: now,
  };
}

function plain(value: string, max = 10000) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
export function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function lines(text: string, maxItems = 25) {
  return plain(text).split(/\n+/).map(s => s.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean).slice(0, maxItems);
}

export function generateCvHtml(cv: TailoredCv, job: Pick<DiscoveredJob, 'role' | 'company' | 'description'>): string {
  const p = cv.profile;
  const evidence = [p.verifiedFacts, p.education, p.certifications].join('\n');
  const directlySupported = assessRequiredSkills(job, evidence).filter(a => a.fit === 'direct');
  const verifiedSelected = directlySupported.filter(a => cv.selectedSkills.includes(a.skill));
  const fragments = lines(p.verifiedFacts);
  const ordered = [...fragments].sort((a, b) =>
    verifiedSelected.filter(item => item.evidence.includes(b) || b.includes(item.evidence)).length - verifiedSelected.filter(item => item.evidence.includes(a) || a.includes(item.evidence)).length);
  const skills = verifiedSelected.map(s => s.skill);
  const skillHtml = skills.length ? '<section><h2>RELEVANT VERIFIED SKILLS</h2><p>' +
    escapeHtml(skills.join('  •  ')) + '</p></section>' : '';
  const intro = skills.length
    ? 'Experience with ' + skills.slice(0, 4).join(', ') + '.'
    : 'Professional background and experience detailed below.';
  const ul = (items: string[]) => items.length
    ? '<ul>' + items.map(i => '<li>' + escapeHtml(i) + '</li>').join('') + '</ul>' : '';
  const section = (title: string, content: string, list = false) =>
    content.trim() ? '<section><h2>' + title + '</h2>' +
      (list ? ul(lines(content)) : '<p>' + escapeHtml(plain(content)) + '</p>') + '</section>' : '';
  const title = plain(p.fullName || 'Your Name', 120);
  const role = plain(p.headline || 'Professional', 120);
  // Target title is intentionally not presented as an existing job title or qualification.
  const target = plain(job.role, 140) + ' at ' + plain(job.company, 120);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - Tailored CV</title>
<style>
@page{size:A4;margin:17mm 19mm}*{box-sizing:border-box}
body{font:10.5pt/1.55 Arial,Helvetica,sans-serif;color:#1b2941;max-width:800px;margin:0 auto;padding:22px;background:white}
header{border-bottom:3px solid #1356a2;padding:0 0 13px;margin-bottom:15px}h1{font-size:22pt;color:#123b71;letter-spacing:-.5px;margin:0}
.subtitle{font-size:11pt;color:#2d588d;margin:4px 0 3px}small,.contact{color:#5b6780;font-size:9pt}
section{margin:14px 0;break-inside:avoid}h2{font-size:10pt;letter-spacing:1px;border-bottom:1px solid #d6e0ed;padding-bottom:3px;color:#164778;margin:0 0 7px}
p{margin:4px 0}ul{margin:5px 0;padding-left:18px}li{padding:2px 0;break-inside:avoid}
.target{font-size:9pt;color:#57667c;margin-top:5px}
@media print{body{padding:0;max-width:none}.print-ui{display:none!important}}
.print-ui{position:sticky;top:0;background:#eaf3ff;border:1px solid #c9dcff;border-radius:8px;padding:10px;margin-bottom:20px}
button{background:#125ed2;color:white;border:0;border-radius:6px;padding:9px 13px}
</style></head><body>
<div class="print-ui"><button type="button" onclick="window.print()">Print / Save as PDF</button> &nbsp; Verify every CV line before sending. This page is on your device.</div>
<header><h1>${escapeHtml(title)}</h1><div class="subtitle">${escapeHtml(role)}</div>
<div class="contact">${escapeHtml(plain(p.contact, 300))}</div>
<div class="target">Target opportunity: ${escapeHtml(target)}</div></header>
<section><h2>PROFESSIONAL PROFILE</h2><p>${escapeHtml(intro)}</p></section>
${skillHtml}
${ordered.length ? '<section><h2>PROFESSIONAL EXPERIENCE &amp; EVIDENCE</h2>' + ul(ordered) + '</section>' : ''}
${section('EDUCATION', p.education, true)}
${section('CERTIFICATIONS', p.certifications, true)}
${section('LANGUAGES', p.languages, false)}
</body></html>`;
}

export function buildAiReviewPrompt(cv: TailoredCv, job: DiscoveredJob): string {
  return [
    'Review my job-tailored CV for truthful skill alignment. Do not invent job titles, years, achievements, certification, tools, or abilities.',
    'Categorize job requirements as directly evidenced, transferable but unproven, or missing.',
    'Rewrite only existing evidenced achievements into concise, ATS-friendly wording. Flag anything I must verify.',
    '',
    'JOB:', job.role, job.company, job.description.slice(0, 5000),
    '',
    'MY VERIFIED CV SOURCE:', cv.profile.verifiedFacts, cv.profile.education,
    cv.profile.certifications, cv.profile.languages,
  ].join('\n');
}
