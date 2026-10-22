import { describe, expect, it } from 'vitest';
import { assessRequiredSkills, buildAiReviewPrompt, escapeHtml, generateCvHtml, makeInitialCv, type CvSourceProfile } from './cvMaker';
import type { DiscoveredJob } from './discovery';

const job: DiscoveredJob = {
  id:'job1', source:'Test listing', role:'Financial Crime and Fraud Analyst',
  company:'Finance Example', sourceUrl:'https://example.org/apply',
  location:'Doha', remote:false, description:'Transaction monitoring, fraud investigation, EDD, SQL and CAMS required.',
  published:'2026-10-22', eligibility:'Check with employer', sourceChecked:false,
};
const profile: CvSourceProfile = {
  fullName: 'Candidate Name', headline: 'AML Analyst', contact:'Doha, Qatar',
  verifiedFacts:'AML Analyst — Exchange (2025–Present): transaction monitoring, SAR/STR and KYC/CDD.\nHandled customer records and Excel.',
  education:"Bachelor's Degree in Finance, 2022",
  certifications:'Accounting Assistant Certificate',
  languages:'Arabic, French, English',
};

describe('truthful job-specific CV Maker', () => {
  it('distinguishes direct, transferable and unsupported competencies', () => {
    const advice=assessRequiredSkills(job, [profile.verifiedFacts, profile.education].join('\n'));
    expect(advice.find(s=>s.skill==='Transaction monitoring')?.fit).toBe('direct');
    expect(advice.find(s=>s.skill==='Fraud analysis')?.fit).toBe('related');
    expect(advice.find(s=>s.skill==='Enhanced due diligence (EDD)')?.fit).toBe('related');
    expect(advice.find(s=>s.skill==='SQL')?.fit).toBe('related');
    expect(advice.find(s=>s.skill==='CAMS certification')?.fit).toBe('unsupported');
  });
  it('never promotes unsupported or related skills into the CV core skills', () => {
    const cv=makeInitialCv(job,profile);
    expect(cv.selectedSkills).toContain('Transaction monitoring');
    expect(cv.selectedSkills).not.toContain('Enhanced due diligence (EDD)');
    expect(cv.selectedSkills).not.toContain('CAMS certification');
    const html=generateCvHtml({...cv, selectedSkills:[...cv.selectedSkills,'CAMS certification','SQL']},job);
    expect(html).toContain('AML Analyst');
    expect(html).toContain('Bachelor&#39;s Degree');
    expect(html).not.toContain('CAMS certification');
    expect(html).not.toContain('SQL  •');
    expect(html).toContain('Target opportunity:');
  });
  it('escapes malicious HTML from CV and vacancy inputs', () => {
    const cv=makeInitialCv({...job,company:'<script>bad()</script>'},{
      ...profile,fullName:'<img src=x onerror=alert(1)>',
      verifiedFacts:'Handled customer records <script>bad()</script>',
    });
    const html=generateCvHtml(cv,{...job,company:'<script>bad()</script>'});
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>bad()</script>');
  });
  it('preserves real title rather than presenting the target as current employment', () => {
    const cv=makeInitialCv({...job,role:'Head of Fraud'},profile);
    const html=generateCvHtml(cv,{...job,role:'Head of Fraud'});
    expect(html).toContain('AML Analyst');
    expect(html).toContain('Target opportunity: Head of Fraud');
    expect(html).not.toContain('<div class="subtitle">Head of Fraud</div>');
    expect(escapeHtml('<&')).toBe('&lt;&amp;');
  });
  it('prepares an optional ChatGPT prompt without sending data',()=>{
    const p=buildAiReviewPrompt(makeInitialCv(job,profile),job);
    expect(p).toContain('Do not invent');
    expect(p).toContain('AML Analyst');
    expect(p).toContain('Fraud Analyst');
  });
});
