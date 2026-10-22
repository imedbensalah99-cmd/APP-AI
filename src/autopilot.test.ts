import { describe, expect, it } from 'vitest';
import { assessForAutopilot, draftForAutopilot, prepareAutopilot } from './autopilot';
import type { CvSourceProfile } from './cvMaker';
import type { DiscoveredJob, ReviewDraft } from './discovery';
import type { JobApplication } from './types';

const cv: CvSourceProfile = {
  fullName: 'Verified Candidate', headline: 'AML Analyst', contact:'Doha, Qatar',
  verifiedFacts:'AML Analyst at Financial Exchange, 2025–Present: transaction monitoring, KYC/CDD, sanctions screening and SAR reports.\nAccountant Assistant (2021–2022): reconciled financial transactions and assisted financial reporting.',
  education:"Bachelor's Degree in Finance, 2022", certifications:'Accounting Assistant Certificate', languages:'Arabic, English, French',
};
const lead: DiscoveredJob = {
  id:'one', source:'public API', company:'Example Exchange', role:'AML Analyst',
  location:'Doha', sourceUrl:'https://example.org/aml', published:'2026-10-22',
  remote:false, eligibility:'Unverified', sourceChecked:true,
  description:'AML analyst needed for transaction monitoring and KYC. Experience with CDD required. CAMS is a plus.',
};
const app: JobApplication = {
  id:'a', company:lead.company, role:lead.role, location:'Doha', sourceUrl:lead.sourceUrl,
  status:'Applied', appliedOn:'2026-10-22', deadline:'', followUpOn:'', notes:'',
  createdAt:'', updatedAt:'',
};

describe('automatic job application preparation', () => {
  it('prepares only relevant grounded leads and tailored CVs', () => {
    const found = prepareAutopilot([lead], cv, [], [], '2026-10-22T12:00:00Z');
    expect(found.decisions[0].suitability).toBe('prepare');
    expect(found.newDrafts).toHaveLength(1);
    expect(found.newDrafts[0].body).toContain('transaction monitoring');
    expect(found.newDrafts[0].body).not.toContain('I am CAMS certified');
    expect(found.newDrafts[0].body).not.toContain('SQL proficiency');
    expect(found.tailoredCvs[lead.sourceUrl].selectedSkills).toContain('Transaction monitoring');
  });
  it('does not automatically generate drafts for Qatari-only, manager, or 7 year positions', () => {
    const blocked = [
      {...lead, id:'qatari',sourceUrl:'https://example.org/qa', description:lead.description + ' Qatari nationals only.'},
      {...lead, id:'manager',sourceUrl:'https://example.org/manager', role:'AML Manager'},
      {...lead, id:'old',sourceUrl:'https://example.org/senior', description:lead.description + ' 7 years of experience.'},
    ];
    const x=prepareAutopilot(blocked, cv, [], []);
    expect(x.newDrafts).toHaveLength(0);
    expect(x.decisions.every(d => d.suitability === 'exclude')).toBe(true);
  });
  it('stops duplicate preparation and skips already applied jobs', () => {
    const existing: ReviewDraft = {
      id:lead.id, job:lead, body:'A verified draft', recipient:'', status:'Draft', preparedAt:'',
    };
    expect(prepareAutopilot([lead],cv,[existing],[]).newDrafts).toHaveLength(0);
    expect(prepareAutopilot([lead],cv,[],[app]).newDrafts).toHaveLength(0);
  });
  it('requires a saved CV and explains missing evidence', () => {
    const candidate={...cv, fullName:'',verifiedFacts:''};
    const outcome=prepareAutopilot([lead],candidate,[],[]);
    expect(outcome.newDrafts).toHaveLength(0);
    expect(assessForAutopilot(lead,'',[]).suitability).toBe('review');
  });
  it('does not copy unsupported job claims into the application text', () => {
    const job={...lead, description:lead.description+' Python expert required.'};
    const draft=draftForAutopilot(job,cv);
    expect(draft).toContain('Verified Candidate');
    expect(draft).not.toContain('Python expert');
    expect(draft).not.toContain('CAMS');
  });
});
